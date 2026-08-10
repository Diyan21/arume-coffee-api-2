/**
 * Standardized JSON Success Response
 * @param {Object} c - Hono Context
 * @param {Object|Array} data - Payload data
 * @param {String} message - Response message
 * @param {Number} status - HTTP status code
 */
export const successResponse = (c, data = {}, message = 'Success', status = 200) => {
  return c.json(
    {
      success: true,
      message,
      data
    },
    status
  );
};

/**
 * Standardized JSON Error Response
 * @param {Object} c - Hono Context
 * @param {String} message - Error message summary
 * @param {String|Object} error - Detailed error info or code
 * @param {Number} status - HTTP status code
 */
export const errorResponse = (c, message = 'An error occurred', error = null, status = 400) => {
  let formattedError = error;
  if (error instanceof Error) {
    formattedError = error.message;
  } else if (typeof error === 'object' && error !== null) {
    formattedError = JSON.stringify(error);
  }

  return c.json(
    {
      success: false,
      message,
      error: formattedError
    },
    status
  );
};
