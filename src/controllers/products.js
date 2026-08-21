import { getSupabaseClient } from '../config/supabase.js';
import { successResponse, errorResponse } from '../utils/response.js';

/**
 * GET /api/products
 * Ambil semua produk aktif
 * Optional query:
 * /api/products?category=Signature
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
      .eq('is_active', true)
      .order('id', { ascending: true });

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
      err?.message || String(err),
      500
    );
  }
};


/**
 * GET /api/products/:id
 * Ambil detail satu produk aktif berdasarkan ID
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
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      console.error('Get product by ID error:', error);

      return errorResponse(
        c,
        'Failed to fetch product details',
        error.message,
        500
      );
    }

    if (!data) {
      return errorResponse(
        c,
        'Product not found',
        `No active product found with ID ${id}`,
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
      err?.message || String(err),
      500
    );
  }
};


/**
 * Helper untuk orders.js
 *
 * Ambil beberapa produk aktif berdasarkan array ID.
 * Digunakan backend untuk validasi:
 * - product_id
 * - nama produk
 * - harga asli dari database
 * - status produk
 *
 * Frontend tidak boleh dijadikan sumber harga utama.
 */
export const getProductsByIds = async (
  env,
  productIds = []
) => {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return [];
  }

  // Hilangkan duplicate ID
  const uniqueProductIds = [
    ...new Set(
      productIds
        .filter(Boolean)
        .map((id) => String(id).trim())
        .filter(Boolean)
    )
  ];

  if (uniqueProductIds.length === 0) {
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
    .in('id', uniqueProductIds)
    .eq('is_active', true);

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
