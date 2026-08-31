import {
  getSupabaseClient
} from '../config/supabase.js';

import {
  createXenditPaymentSession,
  getXenditPaymentSession,
  verifyXenditWebhook
} from '../config/payment.js';

import {
  updateOrderStatus,
  adjustStockForOrder
} from './orders.js';

import {
  successResponse,
  errorResponse
} from '../utils/response.js';


/*
 * Runtime cache.
 * Hanya lapisan tambahan.
 * Idempotency utama tetap database.
 */
const processedCallbackMap = new Map();


/* =========================================================
   HELPER
   ========================================================= */

const normalizeEvent = (event) => {
  return String(event || '').trim().toLowerCase();
};


const getPaymentMethod = (data = {}) => {

  const candidate =
    data?.payment_method?.type ||
    data?.payment_method?.channel_code ||
    data?.payment_method?.channel_properties?.channel_code ||
    data?.channel_code ||
    data?.payment_channel ||
    null;

  if (!candidate) {
    return null;
  }

  if (typeof candidate === 'string') {
    return candidate;
  }

  try {
    return JSON.stringify(candidate);
  } catch {
    return 'xendit';
  }
};


/*
 * reference_id yang kita kirim ke Xendit
 * harus sebisa mungkin sama dengan order_number.
 *
 * Helper ini juga menerima reference_id lama
 * kalau sebelumnya kita pernah membuat format
 * ORDERNUMBER-timestamp.
 */
const extractPossibleOrderNumber = (
  referenceId
) => {

  if (!referenceId) {
    return null;
  }

  const ref =
    String(referenceId).trim();

  if (!ref) {
    return null;
  }

  /*
   * Prioritas:
   * reference_id langsung dianggap
   * sebagai order_number.
   *
   * Nanti lookup database akan memastikan
   * apakah benar ada order tersebut.
   */
  return ref;
};


/* =========================================================
   CREATE PAYMENT
   POST /api/payment/create
   ========================================================= */

export const createPayment =
async (c) => {

  try {

    const body =
      await c.req
        .json()
        .catch(() => ({}));


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


    if (!supabase) {
      return errorResponse(
        c,
        'Database is not configured',
        null,
        500
      );
    }


    /* -----------------------------------------------------
       GET ORDER
       ----------------------------------------------------- */

    const {
      data: orderRecord,
      error: orderError
    } =
      await supabase
        .from('orders')
        .select('*')
        .eq(
          'order_number',
          order_number
        )
        .maybeSingle();


    if (orderError) {

      console.error(
        'Failed to find order:',
        orderError
      );

      return errorResponse(
        c,
        'Failed to find order',
        orderError.message,
        500
      );
    }


    if (!orderRecord) {
      return errorResponse(
        c,
        'Order not found',
        `Order number '${order_number}' does not exist`,
        404
      );
    }


    /* -----------------------------------------------------
       ALREADY PAID
       ----------------------------------------------------- */

    if (
      orderRecord.status === 'paid' ||
      orderRecord.status === 'settled'
    ) {
      return errorResponse(
        c,
        'Order already paid',
        `Order '${order_number}' is already paid`,
        400
      );
    }


    /* -----------------------------------------------------
       REUSE EXISTING SESSION
       ----------------------------------------------------- */

    if (
      orderRecord.status === 'pending' &&
      orderRecord.payment_provider === 'xendit' &&
      orderRecord.payment_id &&
      orderRecord.payment_url
    ) {

      return successResponse(
        c,
        {
          order_number,

          payment: {
            provider: 'xendit',

            session_id:
              orderRecord.payment_id,

            redirect_url:
              orderRecord.payment_url,

            payment_link_url:
              orderRecord.payment_url,

            reused: true
          }
        },
        'Existing Xendit payment session returned'
      );
    }


    /* -----------------------------------------------------
       LOAD ORDER ITEMS
       ----------------------------------------------------- */

    const {
      data: orderItems,
      error: itemsError
    } =
      await supabase
        .from('order_items')
        .select('*')
        .eq(
          'order_id',
          orderRecord.id
        );


    if (itemsError) {
      console.error(
        'Failed loading order items:',
        itemsError
      );
    }


    /* -----------------------------------------------------
       CREATE XENDIT SESSION
       ----------------------------------------------------- */

    const paymentResult =
      await createXenditPaymentSession(
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
          },

          items:
            orderItems || []
        }
      );


    if (
      !paymentResult ||
      !paymentResult.session_id ||
      !paymentResult.redirect_url
    ) {

      console.error(
        'Invalid Xendit payment result:',
        paymentResult
      );

      return errorResponse(
        c,
        'Invalid response from Xendit',
        paymentResult,
        502
      );
    }


    /* -----------------------------------------------------
       SAVE PAYMENT SESSION
       ----------------------------------------------------- */

    const {
      error: updateError
    } =
      await supabase
        .from('orders')
        .update({
          payment_provider:
            'xendit',

          payment_id:
            paymentResult.session_id,

          payment_url:
            paymentResult.redirect_url,

          payment_method:
            null,

          snap_token:
            null
        })
        .eq(
          'id',
          orderRecord.id
        );


    if (updateError) {

      console.error(
        'Failed saving Xendit payment session:',
        updateError
      );

      return errorResponse(
        c,
        'Payment created but failed to save payment session',
        updateError.message,
        500
      );
    }


    return successResponse(
      c,
      {
        order_number,

        payment:
          paymentResult
      },
      'Xendit payment session created successfully'
    );


  } catch (err) {

    console.error(
      'Create Payment Error:',
      err
    );


    return errorResponse(
      c,
      'Failed to create payment transaction',
      err?.message || err,
      500
    );
  }
};


/* =========================================================
   XENDIT WEBHOOK
   POST /api/payment/callback
   ========================================================= */

export const handlePaymentCallback =
async (c) => {

  try {

    /* -----------------------------------------------------
       1. VERIFY WEBHOOK TOKEN
       ----------------------------------------------------- */

    const callbackToken =
      c.req.header(
        'x-callback-token'
      );


    const isValid =
      verifyXenditWebhook(
        c.env,
        callbackToken
      );


    if (!isValid) {

      console.error(
        'Invalid Xendit callback token'
      );

      return errorResponse(
        c,
        'Invalid Xendit webhook token',
        'Webhook verification failed',
        403
      );
    }


    /* -----------------------------------------------------
       2. READ PAYLOAD
       ----------------------------------------------------- */

    const body =
      await c.req
        .json()
        .catch(() => ({}));


    console.log(
      'Xendit Webhook:',
      JSON.stringify(body)
    );


    const event =
      normalizeEvent(
        body?.event
      );


    const data =
      body?.data || {};


    /*
     * Webhook Xendit Payment Session:
     *
     * data.payment_session_id
     * data.reference_id
     * data.payment_id
     */
    const paymentSessionId =
      data?.payment_session_id ||
      body?.payment_session_id ||
      null;


    const referenceId =
      data?.reference_id ||
      body?.reference_id ||
      null;


    const paymentId =
      data?.payment_id ||
      data?.payment_request_id ||
      null;


    /* -----------------------------------------------------
       TEST WEBHOOK
       ----------------------------------------------------- */

    /*
     * Tombol "Tes dan simpan" Xendit
     * bisa mengirim payload test yang
     * tidak terhubung dengan order asli
     * kita.
     *
     * Karena token webhook sudah valid,
     * endpoint boleh mengembalikan HTTP 200
     * agar Xendit mengetahui endpoint aktif.
     *
     * Tetapi event asli Payment Session
     * tetap diproses normal jika punya
     * payment_session_id / reference_id.
     */
    if (
      !paymentSessionId &&
      !referenceId &&
      !paymentId
    ) {

      console.log(
        'Xendit webhook received without transaction reference. Treating as connectivity test.'
      );


      return successResponse(
        c,
        {
          received: true,
          event:
            event || 'test',
          test_webhook: true
        },
        'Xendit webhook endpoint is reachable'
      );
    }


    /* -----------------------------------------------------
       3. DATABASE
       ----------------------------------------------------- */

    const supabase =
      getSupabaseClient(
        c.env
      );


    if (!supabase) {
      return errorResponse(
        c,
        'Database is not configured',
        null,
        500
      );
    }


    let orderRecord =
      null;


    let orderNumber =
      data?.metadata?.order_number ||
      body?.metadata?.order_number ||
      null;


    /* -----------------------------------------------------
       4. LOOKUP BY PAYMENT SESSION ID
       ----------------------------------------------------- */

    if (paymentSessionId) {

      const {
        data: foundOrder,
        error: lookupError
      } =
        await supabase
          .from('orders')
          .select('*')
          .eq(
            'payment_id',
            paymentSessionId
          )
          .maybeSingle();


      if (lookupError) {
        console.error(
          'Order lookup by payment session:',
          lookupError
        );
      }


      if (foundOrder) {

        orderRecord =
          foundOrder;

        orderNumber =
          foundOrder.order_number;
      }
    }


    /* -----------------------------------------------------
       5. LOOKUP BY REFERENCE ID
       ----------------------------------------------------- */

    if (
      !orderRecord &&
      referenceId
    ) {

      const candidateOrderNumber =
        extractPossibleOrderNumber(
          referenceId
        );


      console.log(
        'Xendit reference_id:',
        candidateOrderNumber
      );


      /*
       * Pertama coba exact match.
       */
      const {
        data: exactOrder,
        error: exactError
      } =
        await supabase
          .from('orders')
          .select('*')
          .eq(
            'order_number',
            candidateOrderNumber
          )
          .maybeSingle();


      if (exactError) {
        console.error(
          'Exact reference_id lookup failed:',
          exactError
        );
      }


      if (exactOrder) {

        orderRecord =
          exactOrder;

        orderNumber =
          exactOrder.order_number;
      }
    }


    /* -----------------------------------------------------
       6. LOOKUP BY METADATA ORDER NUMBER
       ----------------------------------------------------- */

    if (
      !orderRecord &&
      orderNumber
    ) {

      const {
        data: foundOrder,
        error: lookupError
      } =
        await supabase
          .from('orders')
          .select('*')
          .eq(
            'order_number',
            orderNumber
          )
          .maybeSingle();


      if (lookupError) {
        console.error(
          'Order lookup by order number:',
          lookupError
        );
      }


      if (foundOrder) {
        orderRecord =
          foundOrder;
      }
    }


    /* -----------------------------------------------------
       TEST / UNKNOWN ORDER
       ----------------------------------------------------- */

    if (!orderRecord) {

      /*
       * Xendit dashboard Test & Save bisa
       * menggunakan dummy reference.
       *
       * Kita sudah memverifikasi
       * x-callback-token, jadi cukup
       * acknowledge 200 dan jangan
       * menyentuh database.
       */
      console.warn(
        'Authenticated Xendit webhook does not match a real order:',
        {
          event,
          paymentSessionId,
          referenceId
        }
      );


      return successResponse(
        c,
        {
          received: true,
          event:
            event || 'unknown',

          payment_session_id:
            paymentSessionId,

          reference_id:
            referenceId,

          matched_order:
            false
        },
        'Xendit webhook received'
      );
    }


    orderNumber =
      orderRecord.order_number;


    /* -----------------------------------------------------
       7. TRANSACTION ID
       ----------------------------------------------------- */

    const transactionId =
      paymentId ||
      paymentSessionId ||
      `${event}:${orderNumber}`;


    const idempotencyKey =
      `${transactionId}:${event}`;


    /* -----------------------------------------------------
       8. RUNTIME IDEMPOTENCY
       ----------------------------------------------------- */

    if (
      processedCallbackMap.has(
        idempotencyKey
      )
    ) {

      return successResponse(
        c,
        {
          order_number:
            orderNumber,

          transaction_id:
            transactionId,

          event,

          idempotent:
            true
        },
        'Webhook already processed'
      );
    }


    /* -----------------------------------------------------
       9. DATABASE IDEMPOTENCY
       ----------------------------------------------------- */

    const {
      data: existingPayment,
      error: existingPaymentError
    } =
      await supabase
        .from('payments')
        .select(
          'id, transaction_id, transaction_status'
        )
        .eq(
          'transaction_id',
          transactionId
        )
        .eq(
          'transaction_status',
          event
        )
        .maybeSingle();


    if (existingPaymentError) {
      console.error(
        'Payment history lookup:',
        existingPaymentError
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
            orderNumber,

          transaction_id:
            transactionId,

          event,

          idempotent:
            true
        },
        'Xendit webhook already recorded'
      );
    }


    /* -----------------------------------------------------
       10. MAP EVENT -> ORDER STATUS
       ----------------------------------------------------- */

    let newOrderStatus =
      orderRecord.status ||
      'pending';


    if (
      event ===
      'payment_session.completed'
    ) {

      newOrderStatus =
        'paid';
    }


    else if (
      event ===
      'payment_session.expired'
    ) {

      newOrderStatus =
        'failed';
    }


    /*
     * Dukungan tambahan kalau nanti
     * Payment webhook Xendit juga dipakai.
     */
    else if (
      event === 'payment.succeeded' ||
      event === 'payment.capture'
    ) {

      newOrderStatus =
        'paid';
    }


    else if (
      event === 'payment.failed'
    ) {

      newOrderStatus =
        'failed';
    }


    else if (
      event === 'payment.refund' ||
      event === 'refund.succeeded'
    ) {

      newOrderStatus =
        'refunded';
    }


    else {

      console.log(
        'Unhandled Xendit event:',
        event
      );


      /*
       * Event valid tetapi tidak kita
       * gunakan untuk mengubah status.
       */
      return successResponse(
        c,
        {
          received: true,
          order_number:
            orderNumber,

          event,

          order_status:
            orderRecord.status
        },
        'Xendit webhook received but no status change required'
      );
    }


    /* -----------------------------------------------------
       11. PAYMENT INFO
       ----------------------------------------------------- */

    const paymentMethod =
      getPaymentMethod(
        data
      );


    const grossAmount =
      Number(
        data?.amount ??
        body?.amount ??
        orderRecord.total_amount ??
        0
      );


    /* -----------------------------------------------------
       12. UPDATE ORDER STATUS
       ----------------------------------------------------- */

    await updateOrderStatus(
      c.env,
      orderNumber,
      newOrderStatus,
      {
        transaction_id:
          transactionId,

        payment_type:
          paymentMethod ||
          'xendit',

        transaction_status:
          event
      }
    );


    /* -----------------------------------------------------
       13. UPDATE XENDIT FIELDS
       ----------------------------------------------------- */

    const orderUpdate = {
      payment_provider:
        'xendit',

      payment_id:
        paymentSessionId ||
        orderRecord.payment_id,

      payment_method:
        paymentMethod
          ? String(paymentMethod)
          : orderRecord.payment_method
    };


    /*
     * Hanya set paid_at pertama kali.
     */
    if (
      newOrderStatus === 'paid' &&
      !orderRecord.paid_at
    ) {

      orderUpdate.paid_at =
        data?.updated ||
        body?.created ||
        new Date().toISOString();
    }


    const {
      error: paymentUpdateError
    } =
      await supabase
        .from('orders')
        .update(
          orderUpdate
        )
        .eq(
          'id',
          orderRecord.id
        );


    if (paymentUpdateError) {
      console.error(
        'Xendit order payment update failed:',
        paymentUpdateError
      );
    }


    /* -----------------------------------------------------
       14. STOCK MANAGEMENT
       ----------------------------------------------------- */

    /*
     * orders.js lu sudah punya
     * stock_processed / stock_restored.
     *
     * Jadi adjustStockForOrder tetap menjadi
     * pengaman utama agar stok tidak diproses
     * dua kali.
     */
    if (
      newOrderStatus === 'paid' &&
      orderRecord.status !== 'paid' &&
      orderRecord.status !== 'settled'
    ) {

      try {

        const stockResult =
          await adjustStockForOrder(
            c.env,
            orderNumber,
            'decrease'
          );


        console.log(
          'Stock deduction result:',
          stockResult
        );

      } catch (
        stockError
      ) {

        console.error(
          'Stock deduction failed:',
          stockError
        );
      }
    }


    if (
      newOrderStatus === 'refunded' &&
      orderRecord.status !== 'refunded'
    ) {

      try {

        const stockResult =
          await adjustStockForOrder(
            c.env,
            orderNumber,
            'increase'
          );


        console.log(
          'Stock restoration result:',
          stockResult
        );

      } catch (
        stockError
      ) {

        console.error(
          'Stock restoration failed:',
          stockError
        );
      }
    }


    /* -----------------------------------------------------
       15. STORE PAYMENT HISTORY
       ----------------------------------------------------- */

    const {
      error: paymentInsertError
    } =
      await supabase
        .from('payments')
        .insert({

          order_number:
            orderNumber,

          transaction_id:
            transactionId,

          payment_type:
            paymentMethod
              ? String(paymentMethod)
              : 'xendit',

          gross_amount:
            grossAmount,

          transaction_status:
            event,

          fraud_status:
            null,

          payment_provider:
            'xendit',

          transaction_time:
            body?.created ||
            data?.created ||
            new Date()
              .toISOString(),

          settlement_time:
            newOrderStatus === 'paid'
              ? (
                  data?.updated ||
                  body?.created ||
                  new Date()
                    .toISOString()
                )
              : null,

          raw_response:
            body
        });


    if (paymentInsertError) {

      console.error(
        'Payment history insert error:',
        paymentInsertError
      );
    }


    /* -----------------------------------------------------
       16. MARK RUNTIME PROCESSED
       ----------------------------------------------------- */

    processedCallbackMap.set(
      idempotencyKey,
      true
    );


    /* -----------------------------------------------------
       17. RESPONSE
       ----------------------------------------------------- */

    return successResponse(
      c,
      {
        order_number:
          orderNumber,

        order_status:
          newOrderStatus,

        transaction_id:
          transactionId,

        payment_session_id:
          paymentSessionId,

        event,

        provider:
          'xendit'
      },
      'Xendit webhook processed successfully'
    );


  } catch (err) {

    console.error(
      'Xendit Callback Error:',
      err
    );


    return errorResponse(
      c,
      'Failed to process Xendit webhook',
      err?.message || err,
      500
    );
  }
};


/* =========================================================
   CHECK PAYMENT STATUS
   POST /api/payment/check
   ========================================================= */

export const checkPaymentStatus =
async (c) => {

  try {

    const body =
      await c.req
        .json()
        .catch(() => ({}));


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


    if (!supabase) {
      return errorResponse(
        c,
        'Database is not configured',
        null,
        500
      );
    }


    /* -----------------------------------------------------
       GET ORDER
       ----------------------------------------------------- */

    const {
      data: order,
      error: orderError
    } =
      await supabase
        .from('orders')
        .select(`
          order_number,
          total_amount,
          status,
          payment_provider,
          payment_id,
          payment_method,
          payment_url,
          paid_at,
          stock_processed,
          stock_restored,
          created_at,
          updated_at
        `)
        .eq(
          'order_number',
          order_number
        )
        .maybeSingle();


    if (orderError) {

      console.error(
        'Order status lookup error:',
        orderError
      );

      return errorResponse(
        c,
        'Failed to check order',
        orderError.message,
        500
      );
    }


    if (!order) {
      return errorResponse(
        c,
        'Order not found',
        `Order '${order_number}' does not exist`,
        404
      );
    }


    /* -----------------------------------------------------
       XENDIT SESSION CHECK
       ----------------------------------------------------- */

    let xenditSession =
      null;


    if (
      order.payment_provider === 'xendit' &&
      order.payment_id
    ) {

      try {

        xenditSession =
          await getXenditPaymentSession(
            c.env,
            order.payment_id
          );

      } catch (
        sessionError
      ) {

        console.error(
          'Xendit session lookup failed:',
          sessionError
        );
      }
    }


    /* -----------------------------------------------------
       PAYMENT HISTORY
       ----------------------------------------------------- */

    const {
      data: payments,
      error: paymentsError
    } =
      await supabase
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


    if (paymentsError) {
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

        payment_provider:
          order.payment_provider,

        payment_method:
          order.payment_method,

        payment_url:
          order.payment_url,

        paid_at:
          order.paid_at,

        stock_processed:
          order.stock_processed,

        stock_restored:
          order.stock_restored,

        xendit_session:
          xenditSession,

        payments:
          payments || []
      },
      'Payment status checked successfully'
    );


  } catch (err) {

    console.error(
      'Check Payment Status Error:',
      err
    );


    return errorResponse(
      c,
      'Failed to check payment status',
      err?.message || err,
      500
    );
  }
};
