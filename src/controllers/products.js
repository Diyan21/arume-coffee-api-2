import { getSupabaseClient } from '../config/supabase.js';
import { successResponse, errorResponse } from '../utils/response.js';

/**
 * GET /api/products
 */
export const getProducts = async (c) => {
  try {
    const supabase = getSupabaseClient(c.env);
    const category = c.req.query('category');

    if (!supabase) {
      return errorResponse(
        c,
        'Database unavailable',
        'Supabase connection unavailable',
        503
      );
    }

    let query = supabase
      .from('products')
      .select('*')
      .eq('is_active', true);

    if (category) {
      query = query.ilike('category', category);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Get products error:', error);

      return errorResponse(
        c,
        'Failed to fetch products',
        error.message,
        500
      );
    }

    return successResponse(
      c,
      data || [],
      'Products retrieved successfully'
    );
  } catch (err) {
    console.error('Get Products Error:', err);

    return errorResponse(
      c,
      'Failed to fetch products',
      err?.message || err,
      500
    );
  }
};


/**
 * GET /api/products/:id
 */
export const getProductById = async (c) => {
  try {
    const id = c.req.param('id');

    if (!id) {
      return errorResponse(
        c,
        'Product ID is required',
        null,
        400
      );
    }

    const supabase = getSupabaseClient(c.env);

    if (!supabase) {
      return errorResponse(
        c,
        'Database unavailable',
        'Supabase connection unavailable',
        503
      );
    }

    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return errorResponse(
        c,
        'Product not found',
        `No product found with ID ${id}`,
        404
      );
    }

    return successResponse(
      c,
      data,
      'Product details retrieved successfully'
    );
  } catch (err) {
    console.error('Get Product By ID Error:', err);

    return errorResponse(
      c,
      'Failed to fetch product details',
      err?.message || err,
      500
    );
  }
};


/**
 * Helper untuk orders.js
 * Ambil beberapa produk berdasarkan ID.
 */
export const getProductsByIds = async (
  env,
  productIds = []
) => {
  if (
    !Array.isArray(productIds) ||
    productIds.length === 0
  ) {
    return [];
  }

  const supabase = getSupabaseClient(env);

  if (!supabase) {
    throw new Error(
      'Supabase connection unavailable'
    );
  }

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .in('id', productIds);

  if (error) {
    console.error(
      'Get products by IDs error:',
      error
    );

    throw new Error(
      `Failed to fetch products: ${error.message}`
    );
  }

  return data || [];
};
