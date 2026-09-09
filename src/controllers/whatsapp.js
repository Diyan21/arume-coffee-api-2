const normalizePhone =
(value) => {

  let phone =
    String(value || '')
      .replace(
        /[^0-9]/g,
        ''
      )
      .trim();


  if (
    phone.startsWith(
      '0'
    )
  ) {

    phone =
      `62${phone.slice(1)}`;
  }


  return phone;
};


const formatRupiahNumber =
(value) => {

  const number =
    Number(
      value || 0
    );


  return new Intl.NumberFormat(
    'id-ID'
  ).format(
    number
  );
};


const getGraphApiVersion =
(env) => {

  return String(
    env?.WHATSAPP_GRAPH_API_VERSION ||
    env?.WHATSAPP_GRAPH_VERSION ||
    ''
  ).trim();
};


const isWhatsAppConfigured =
(env) => {

  return Boolean(
    env?.WHATSAPP_ACCESS_TOKEN &&
    env?.WHATSAPP_PHONE_NUMBER_ID &&
    getGraphApiVersion(
      env
    )
  );
};


export const sendOrderPaymentSuccessWhatsApp =
async (
  env,
  {
    phoneNumber,
    customerName,
    orderNumber,
    total
  }
) => {

  try {

    if (
      !isWhatsAppConfigured(
        env
      )
    ) {

      console.warn(
        'WhatsApp environment is incomplete'
      );


      return {
        success:
          false,

        skipped:
          true,

        reason:
          'WhatsApp configuration missing'
      };
    }


    const phone =
      normalizePhone(
        phoneNumber
      );


    if (
      !phone
    ) {

      return {
        success:
          false,

        skipped:
          true,

        reason:
          'Customer phone number missing'
      };
    }


    const graphVersion =
      getGraphApiVersion(
        env
      );


    const phoneNumberId =
      String(
        env.WHATSAPP_PHONE_NUMBER_ID
      ).trim();


    const endpoint =
      `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;


    const payload = {

      messaging_product:
        'whatsapp',

      recipient_type:
        'individual',

      to:
        phone,

      type:
        'template',

      template: {

        name:
          'order_payment_success',

        language: {

          code:
            'id'

        },

        components: [

          {

            type:
              'body',

            parameters: [

              {
                type:
                  'text',

                text:
                  String(
                    customerName ||
                    'Kak'
                  )
              },

              {
                type:
                  'text',

                text:
                  String(
                    orderNumber ||
                    '-'
                  )
              },

              {
                type:
                  'text',

                text:
                  formatRupiahNumber(
                    total
                  )
              }

            ]

          }

        ]

      }

    };


    const response =
      await fetch(
        endpoint,
        {

          method:
            'POST',

          headers: {

            Authorization:
              `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,

            'Content-Type':
              'application/json'

          },

          body:
            JSON.stringify(
              payload
            )

        }
      );


    const data =
      await response
        .json()
        .catch(
          () => ({})
        );


    if (
      !response.ok
    ) {

      console.error(
        'WhatsApp template send error:',
        {
          status:
            response.status,

          error:
            data?.error?.message ||
            null,

          code:
            data?.error?.code ||
            null,

          subcode:
            data?.error?.error_subcode ||
            null
        }
      );


      return {

        success:
          false,

        status:
          response.status,

        error:
          data?.error?.message ||
          'Failed to send WhatsApp template',

        meta:
          data

      };
    }


    const messageId =
      data?.messages?.[0]?.id ||
      null;


    const messageStatus =
      data?.messages?.[0]?.message_status ||
      null;


    console.log(
      'WhatsApp template sent:',
      {
        messageId,
        messageStatus,
        phone
      }
    );


    return {

      success:
        true,

      whatsapp_message_id:
        messageId,

      message_status:
        messageStatus,

      phone_number:
        phone

    };

  } catch (
    err
  ) {

    console.error(
      'WhatsApp send exception:',
      err
    );


    return {

      success:
        false,

      status:
        500,

      error:
        err?.message ||
        'Unexpected WhatsApp send error'

    };
  }
};
